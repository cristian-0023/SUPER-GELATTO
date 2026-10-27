// Figura 1 · "La heladería como máquina" (contexto + contenedores).
// Un banco de trabajo con las piezas de la heladería en fila:
// Cliente → Mostrador (página web) → Guardia → Cocina (servidor) → Bodega (base de datos),
// y detrás, en un estante, los proveedores externos cableados a la cocina.
// Uso: node heladeria-maquina.mjs   (escribe ../heladeria-maquina.svg y ../heladeria-maquina.html)
import { k, helpers, basePlate, namePlate, staticSvg, livePage, write } from "./common.mjs";

const WIDTH = 720;
const HEIGHT = 330;
const BASE = { x: -272, y: -158, w: 482, d: 202, r: 10 };
const TRACK_Y = 16;
const GATE_X = -63;

// Paradas del pedido sobre el riel (coordenada x).
const STOP = { cliente: -229, mostrador: -135, guardia: -84, cocina: 20, bodega: 145 };
const PROVIDERS = [
  { id: "google", plate: "GOOGLE", name: "Google", what: "inicio de sesión con Google" },
  { id: "groq", plate: "GROQ", name: "Groq", what: "el chatbot Gelbot" },
  { id: "aws", plate: "AWS", name: "AWS Rekognition", what: "login facial de los admins" },
  { id: "tripo", plate: "TRIPO 3D", name: "Tripo 3D", what: "modelos 3D de productos" },
  { id: "correo", plate: "CORREO", name: "Correo (nodemailer)", what: "avisos por correo al cliente" },
];
const MOD_X = [-96, -48, 0, 48, 96];
const PORT_X = [-4, 8, 20, 32, 44];

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -15, 0),
    [68, -48, 66],
    [-120, -146, 48],
    [120, -146, 48],
    [GATE_X, 3, 48],
    [190, -64, 54],
  ],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 60 },
);
const { at, S, L, D, byDepth } = helpers(P);

function shelf() {
  const out = [];
  const board = { x: -122, y: -150, w: 244, d: 38, r: 2 };
  const legs = byDepth(k.corners(board, 6));
  const back = legs.slice(0, 2);
  for (const [x, y] of legs) {
    out.push(S(k.cylinder(x, y, 3.6, 0, 1.6, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 2.4, 1.6, 20.4, P, 20), { tone: "mid", crease: "none" }));
  }
  // travesaño trasero entre las patas de atrás
  const [a, b] = [...back].sort((p, q) => p[0] - q[0]);
  out.push(S(k.slabOf({ x: a[0] + 2.4, y: a[1] - 1, w: b[0] - a[0] - 4.8, d: 2, r: 0.6 }, 8, 2.4, P, 3), { tone: "lo" }));
  out.push(S(k.slabOf(board, 22, 4, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(board, 24, P, 6), { tone: "faint" }) }));
  out.push(D(k.corners(board, 6).map(([x, y]) => at([x, y, 26])), { size: 0.45 }));
  return out.join("");
}

// Cada proveedor es un módulo con su propia pieza encima.
function module(index) {
  const cx = MOD_X[index];
  const box = { x: cx - 16, y: -144, w: 32, d: 22, r: 2 };
  const top = 40;
  const out = [`<g data-module="${PROVIDERS[index].id}">`];
  out.push(S(k.slabOf(k.insetPlan(box, -1.2), 26, 1.4, P, 4), { tone: "lo", crease: "none" }));
  out.push(S(k.slabOf(box, 27.4, top - 27.4, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(box, 30, P, 4), { tone: "faint" }) }));
  out.push(D(k.corners(box, 3).map(([x, y]) => at([x, y, top])), { size: 0.42 }));
  const cy = box.y + box.d / 2;
  const id = PROVIDERS[index].id;
  if (id === "google") {
    // una llave: argolla y paleta
    out.push(S(k.cylinder(cx - 6, cy, 5, top, 1.6, P, 28), { tone: "hi" }));
    out.push(L(k.ring(cx - 6, cy, 2.2, top + 1.6, P, 18), { tone: "mid" }));
    out.push(S(k.slabOf({ x: cx - 1.4, y: cy - 1.3, w: 13, d: 2.6, r: 0.6 }, top, 1.6, P, 2), { tone: "hi" }));
    out.push(S(k.slabOf({ x: cx + 7, y: cy + 1.3, w: 1.8, d: 2.4, r: 0.3 }, top, 1.6, P, 2), { tone: "hi" }));
    out.push(S(k.slabOf({ x: cx + 9.6, y: cy + 1.3, w: 1.8, d: 3.4, r: 0.3 }, top, 1.6, P, 2), { tone: "hi" }));
  } else if (id === "groq") {
    // globo de diálogo del chatbot
    const bubble = { x: cx - 10, y: cy - 6, w: 20, d: 11, r: 4 };
    out.push(S(k.slabOf({ x: cx - 7, y: cy + 3.5, w: 4, d: 4, r: 1 }, top, 2.4, P, 2), { tone: "hi" }));
    out.push(S(k.slabOf(bubble, top, 3.2, P, 6, 0.5), { tone: "hi", crease: "lo" }));
    out.push(D([-5, 0, 5].map((dx) => at([cx + dx, cy - 0.5, top + 3.2])), { size: 0.9, tone: "hi" }));
  } else if (id === "aws") {
    // cámara: cuerpo, lente y flash
    out.push(S(k.slabOf({ x: cx - 11, y: cy - 6, w: 22, d: 12, r: 2 }, top, 4, P, 4, 0.4), { tone: "hi", crease: "lo" }));
    out.push(S(k.cylinder(cx, cy, 4.6, top + 4, 2.4, P, 28), { tone: "hi", crease: "lo" }));
    out.push(L(k.ring(cx, cy, 2.6, top + 6.4, P, 20) + k.ring(cx, cy, 1.2, top + 6.4, P, 14), { tone: "mid" }));
    out.push(S(k.slabOf({ x: cx + 6, y: cy - 4.6, w: 3.6, d: 2.4, r: 0.6 }, top + 4, 1, P, 2), { tone: "mid" }));
  } else if (id === "tripo") {
    // plato giratorio con un cubo (el modelo 3D)
    out.push(S(k.cylinder(cx, cy, 8.4, top, 1.6, P, 32), { tone: "mid" }));
    out.push(L(k.ring(cx, cy, 6.6, top + 1.6, P, 32), { tone: "faint" }));
    out.push(S(k.slabOf({ x: cx - 3.6, y: cy - 3.6, w: 7.2, d: 7.2, r: 0.5 }, top + 1.6, 7.2, P, 2), { tone: "hi", crease: "lo" }));
  } else {
    // sobre de correo con su solapa y una banderita
    const env = { x: cx - 10, y: cy - 6, w: 20, d: 12, r: 0.8 };
    out.push(S(k.slabOf(env, top, 1.4, P, 2), { tone: "hi", crease: "lo" }));
    out.push(L(k.onTop([[env.x, env.y], [cx, cy + 1], [env.x + env.w, env.y]], top + 1.4, P), { tone: "mid" }));
    out.push(S(k.cylinder(cx + 13, cy + 4, 0.8, top, 9, P, 10), { tone: "mid", crease: "none" }));
    out.push(S(k.slabOf({ x: cx + 12.4, y: cy + 4, w: 1.2, d: 5, r: 0.2 }, top + 6, 3, P, 2), { tone: "mid" }));
  }
  // conector de donde sale el cable
  out.push(S(k.slabOf({ x: cx - 3, y: box.y + box.d, w: 6, d: 2.4, r: 0.6 }, 28.6, 4, P, 2), { tone: "mid" }));
  out.push("</g>");
  out.push(namePlate(P, { x: cx - 19, y: -120, w: 38, d: 8 }, PROVIDERS[index].plate, { z: 26, size: 4.6 }));
  return out.join("");
}

function cliente() {
  const out = [];
  const pad = { x: -254, y: -48, w: 50, d: 42, r: 4 };
  out.push(S(k.slabOf(pad, 0, 8, P, 6, 0.8), { tone: "mid", inner: L(k.sideSeam(pad, 3, P, 6), { tone: "faint" }) }));
  out.push(D(k.corners(pad, 4).map(([x, y]) => at([x, y, 8])), { size: 0.42 }));
  // soporte inclinado del celular: dos topes
  out.push(S(k.slabOf({ x: -246, y: -12, w: 30, d: 3, r: 0.8 }, 8, 3, P, 3), { tone: "lo" }));
  const phone = { x: -241, y: -44, w: 20, d: 34, r: 3 };
  out.push(S(k.slabOf(phone, 8, 2.4, P, 6, 0.5), { tone: "hi", crease: "lo" }));
  out.push(`<g data-part="screen">${L(k.planOutline({ x: -239.4, y: -40, w: 16.8, d: 25, r: 1 }, 10.4, P, 3), { tone: "lo" })}</g>`);
  out.push(L(k.planOutline({ x: -234, y: -42.6, w: 6, d: 1, r: 0.5 }, 10.4, P, 3), { tone: "lo" }));
  out.push(L(k.ring(-231, -12.6, 1.3, 10.4, P, 14), { tone: "lo" }));
  // un portátil pequeño al lado: el navegador
  const lap = { x: -216, y: -40, w: 8, d: 26, r: 1 };
  out.push(S(k.slabOf(lap, 8, 1.6, P, 3), { tone: "mid" }));
  out.push(L(k.onTop([[-214.5, -37], [-214.5, -17]], 9.6, P) + k.onTop([[-211, -37], [-211, -17]], 9.6, P), { tone: "faint", free: true }));
  return out.join("");
}

function mostrador() {
  const out = [];
  const plinth = { x: -183, y: -55, w: 96, d: 52, r: 3 };
  const cab = { x: -181, y: -53, w: 92, d: 48, r: 2 };
  out.push(S(k.slabOf(plinth, 0, 3, P, 4), { tone: "lo" }));
  // tablero del menú, detrás, sobre dos postes
  for (const x of [-170, -110]) out.push(S(k.cylinder(x, -50, 1.6, 22, 26, P, 14), { tone: "mid", crease: "none" }));
  const board = { x: -174, y: -52.6, w: 68, d: 2.4, r: 0.6 };
  out.push(S(k.slabOf(board, 36, 12, P, 3), { tone: "mid" }));
  const face = (x0, x1, z) => k.segment([x0, -50.2, z], [x1, -50.2, z], P);
  out.push(L(face(-170, -136, 45) + face(-170, -146, 42) + face(-170, -128, 39), { tone: "lo", free: true }));
  out.push(D([at([-108.6, -50.2, 46]), at([-171.4, -50.2, 46])], { size: 0.4 }));
  out.push(S(k.slabOf(cab, 3, 19, P, 4, 0.5), {
    tone: "mid",
    inner: L(k.segment([-151, -5, 3], [-151, -5, 22], P) + k.segment([-121, -5, 3], [-121, -5, 22], P), { tone: "faint" }),
  }));
  out.push(S(k.slabOf({ x: -164, y: -5, w: 10, d: 1.4, r: 0.4 }, 15, 2, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -118, y: -5, w: 10, d: 1.4, r: 0.4 }, 15, 2, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf(plinth, 22, 2.4, P, 4, 0.6), { tone: "mid" }));
  // vitrina de vidrio con tres potes de helado
  const glass = { x: -177, y: -47, w: 84, d: 32, r: 2 };
  out.push(S(k.slabOf(glass, 24.4, 10, P, 4, 0.5), {
    tone: "mid",
    inner: L(k.segment([-170, -15, 25.4], [-164, -15, 33.4], P) + k.segment([-166, -15, 25.4], [-160, -15, 33.4], P), { tone: "faint", free: true }),
  }));
  for (const x of [-160, -135, -110]) {
    out.push(L(k.ring(x, -31, 7, 34.4, P, 28), { tone: "mid" }));
    out.push(L(k.ring(x, -31, 4.6, 34.4, P, 24), { tone: "lo" }));
  }
  out.push(D([-160, -135, -110].map((x) => at([x, -31, 34.4])), { size: 0.9, tone: "mid" }));
  return out.join("");
}

function booth() {
  const out = [];
  const b = { x: -82, y: -46, w: 28, d: 28, r: 2 };
  out.push(S(k.slabOf(k.insetPlan(b, -1.5), 0, 2, P, 4), { tone: "lo" }));
  out.push(S(k.slabOf(b, 2, 26, P, 4, 0.5), { tone: "mid", inner: L(k.sideSeam(b, 6, P, 4), { tone: "faint" }) }));
  const win = [[-77, -18, 12], [-59, -18, 12], [-59, -18, 23], [-77, -18, 23]];
  out.push(L(k.pathOf(k.pointsAt(win, P), true), { tone: "lo" }));
  out.push(L(k.segment([-68, -18, 12], [-68, -18, 23], P), { tone: "faint" }));
  out.push(S(k.slabOf(k.insetPlan(b, -2.5), 28, 2.6, P, 4, 0.6), { tone: "mid" }));
  out.push(`<g data-part="lamp">${S(k.cylinder(-68, -32, 2.8, 30.6, 4, P, 20), { tone: "hi", crease: "lo" })}</g>`);
  return out.join("");
}

function cocina() {
  const out = [];
  const cab = { x: -40, y: -60, w: 120, d: 56, r: 2.5 };
  for (const [x, y] of byDepth(k.corners(cab, 7))) out.push(S(k.cylinder(x, y, 3.4, 0, 2.6, P, 18), { tone: "lo" }));
  out.push(S(k.slabOf(cab, 2.6, 33.4, P, 6, 0.6), {
    tone: "mid",
    inner: L(k.segment([0, -4, 2.6], [0, -4, 36], P) + k.segment([40, -4, 2.6], [40, -4, 36], P) + k.sideSeam(cab, 8, P, 6), { tone: "faint" }),
  }));
  // tiradores y perillas en el frente
  for (const x of [-26, 16, 56]) out.push(S(k.slabOf({ x, y: -4, w: 9, d: 1.4, r: 0.4 }, 20, 2, P, 2), { tone: "mid" }));
  for (const x of [-30, -22, -14]) out.push(S(k.slabOf({ x, y: -4, w: 3.6, d: 1.8, r: 0.8 }, 29, 3.6, P, 3), { tone: "hi", crease: "lo" }));
  // chimenea
  out.push(S(k.cylinder(68, -48, 5.6, 36, 1.6, P, 24), { tone: "lo" }));
  out.push(S(k.cylinder(68, -48, 4, 37.6, 24.4, P, 24), { tone: "mid", crease: "none" }));
  out.push(L(k.sideArc(68, -48, 4, 50, P, 16), { tone: "faint" }));
  out.push(S(k.cylinder(68, -48, 5.6, 62, 2.4, P, 24), { tone: "mid" }));
  // regleta trasera con los cinco enchufes de los proveedores
  const block = { x: -12, y: -57, w: 64, d: 11, r: 1.6 };
  out.push(S(k.slabOf(block, 36, 4, P, 4, 0.5), { tone: "mid" }));
  out.push(L(PORT_X.map((x) => k.ring(x, -51.5, 2, 40, P, 14)).join(""), { tone: "lo" }));
  // hornillas y una olla
  out.push(L(k.ring(4, -26, 10, 36, P, 36) + k.ring(4, -26, 6, 36, P, 28), { tone: "lo" }));
  out.push(L(k.ring(44, -26, 10, 36, P, 36) + k.ring(44, -26, 6, 36, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(44, -26, 8, 36, 9, P, 32, 0.6), { tone: "hi", crease: "lo", inner: L(k.sideArc(44, -26, 8, 42, P, 24), { tone: "faint" }) }));
  out.push(L(k.ring(44, -26, 6.4, 45, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(44, -26, 1.6, 45, 2, P, 14), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 52, y: -27.4, w: 9, d: 2.8, r: 1 }, 41, 1.8, P, 3), { tone: "mid" }));
  return out.join("");
}

function cables() {
  return MOD_X.map((cx, i) => {
    const from = at([cx, -119.6, 30.6]);
    const via = [at([cx * 0.25 + PORT_X[i] * 0.75, -63, 43.5])];
    const to = at([PORT_X[i], -51.5, 40]);
    return `<g data-wire="${i}">${k.wireSvg(from, to, { via, tone: "lo", size: 1.1 })}</g>`;
  }).join("");
}

function duct() {
  return S(k.slabOf({ x: 80, y: -44, w: 20, d: 20, r: 1 }, 20, 11, P, 3, 0.4), { tone: "lo", inner: L(k.segment([90, -24, 20], [90, -24, 31], P), { tone: "faint" }) });
}

// Cajón del medio de la bodega: se reconstruye al abrirse (open en unidades).
function drawerSvg(K, P, open) {
  const x = 104, w = 82, front = -4 + open;
  const parts = [];
  if (open > 0.3) {
    parts.push(K.solidSvg(K.slabOf({ x: x + 2, y: -4, w: w - 4, d: open, r: 0.4 }, 21, 10, P, 2), { tone: "mid" }));
    for (const cx of [118, 134, 150, 166]) parts.push(K.lineSvg(K.ring(cx, Math.min(-4 + open, 2) - 3.4, 2.6, 31, P, 16), { tone: "lo" }));
  }
  parts.push(K.solidSvg(K.slabOf({ x, y: front, w, d: 1.6, r: 0.5 }, 20, 12, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  parts.push(K.solidSvg(K.slabOf({ x: 139, y: front + 1.6, w: 12, d: 1.4, r: 0.4 }, 25, 2, P, 2), { tone: "mid" }));
  return parts.join("");
}

function bodega() {
  const out = [];
  const chest = { x: 100, y: -62, w: 90, d: 58, r: 2 };
  out.push(S(k.slabOf(k.insetPlan(chest, -1.5), 0, 3, P, 4), { tone: "lo" }));
  out.push(S(k.slabOf(chest, 3, 45, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(chest, -2), 48, 4, P, 4, 0.8), { tone: "mid" }));
  for (const x of [118, 166]) out.push(S(k.slabOf({ x, y: -65.4, w: 8, d: 2, r: 0.4 }, 47, 4, P, 2), { tone: "lo" }));
  // termómetro de la cámara fría
  out.push(S(k.cylinder(170, -36, 9, 52, 3, P, 40, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.ring(170, -36, 7.4, 55, P, 40), { tone: "lo" }));
  const ticks = k.radialTicks(170, -36, 7.2, 20, 5, 55, [1.1, 2.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.lineOnTop([170, -36], [165, -40.5], 55.2, P), { tone: "hi", free: "end" }));
  out.push(D([at([170, -36, 55.2])], { size: 0.7, tone: "hi" }));
  // copo de nieve grabado en la tapa
  const flake = [0, 60, 120].map((a) => {
    const r = (a * Math.PI) / 180;
    return k.lineOnTop([132 - 6 * Math.cos(r), -34 - 6 * Math.sin(r)], [132 + 6 * Math.cos(r), -34 + 6 * Math.sin(r)], 52, P);
  });
  out.push(L(flake.join(""), { tone: "faint", free: true }));
  // cajones: abajo y arriba fijos, el del medio se abre
  const fixed = (z) => S(k.slabOf({ x: 104, y: -4, w: 82, d: 1.6, r: 0.5 }, z, 12, P, 2, 0.3), { tone: "hi", crease: "lo" }) + S(k.slabOf({ x: 139, y: -2.4, w: 12, d: 1.4, r: 0.4 }, z + 5, 2, P, 2), { tone: "mid" });
  out.push(fixed(6), fixed(34));
  out.push(`<g data-part="drawer">${drawerSvg(k, P, 0)}</g>`);
  return out.join("");
}

function track() {
  const out = [];
  const rail = { x: -258, y: TRACK_Y - 4, w: 446, d: 8, r: 1.5 };
  out.push(S(k.slabOf(rail, 0, 3, P, 4, 0.4), { tone: "mid" }));
  out.push(L(k.lineOnTop([rail.x, TRACK_Y], [rail.x + rail.w, TRACK_Y], 3, P), { tone: "faint" }));
  const dots = [];
  for (let x = rail.x + 10; x < rail.x + rail.w - 4; x += 36) dots.push(at([x, TRACK_Y - 2.2, 3]), at([x, TRACK_Y + 2.2, 3]));
  out.push(D(dots, { size: 0.4, tone: "lo" }));
  for (const x of [rail.x - 4, rail.x + rail.w]) out.push(S(k.slabOf({ x, y: TRACK_Y - 7, w: 4, d: 14, r: 1 }, 0, 7, P, 3, 0.4), { tone: "mid" }));
  return out.join("");
}

function gate() {
  const out = [];
  for (const y of [5, 27]) {
    out.push(S(k.cylinder(GATE_X, y, 3.8, 0, 2, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(GATE_X, y, 2.2, 2, 42, P, 18), { tone: "mid", crease: "none" }));
  }
  out.push(S(k.slabOf({ x: GATE_X - 2.4, y: 2, w: 4.8, d: 28, r: 1 }, 44, 3.4, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([GATE_X, 5, 47.4]), at([GATE_X, 27, 47.4])], { size: 0.45 }));
  return out.join("");
}

function gateBar() {
  const bar = { x: GATE_X - 1.5, y: 7.4, w: 3, d: 17.2, r: 0.6 };
  const stripes = [10, 14, 18, 22].map((y) => k.lineOnTop([bar.x, y], [bar.x + bar.w, y + 1.6], 16, P)).join("");
  return S(k.slabOf(bar, 12, 4, P, 2), { tone: "hi", crease: "lo", inner: L(stripes, { tone: "mid" }) });
}

function puck() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -8, y: TRACK_Y - 6, w: 16, d: 12, r: 3 }, 3, 0.1, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf({ x: -9, y: TRACK_Y - 6.5, w: 18, d: 13, r: 2 }, 3, 3.6, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([-6.5, TRACK_Y + 5, 6.6]), at([6.5, TRACK_Y + 5, 6.6])], { size: 0.4 }));
  out.push(S(k.cylinder(0, TRACK_Y, 4.6, 6.6, 9, P, 28), { tone: "hi", lit: true }));
  out.push(S(k.cylinder(0, TRACK_Y, 5.6, 15.6, 5.4, P, 28, 1.4), { tone: "hi", lit: true }));
  out.push(S(k.cylinder(1.2, TRACK_Y - 1, 1.3, 21, 1.6, P, 12), { tone: "hi", lit: true }));
  return out.join("");
}

const plates = [
  [{ x: -262, y: 28, w: 62 }, "1 CLIENTE"],
  [{ x: -180, y: 28, w: 86 }, "2 MOSTRADOR"],
  [{ x: -88, y: 33, w: 64 }, "3 GUARDIA"],
  [{ x: -14, y: 28, w: 66 }, "4 COCINA"],
  [{ x: 112, y: 28, w: 66 }, "5 BODEGA"],
];

const LABEL =
  "La heladería como máquina. Sobre un banco, en fila: el cliente con su celular, el mostrador (la página web, hecha con React y publicada en Vercel), un guardia con una barrera, la cocina (el servidor, hecho con Express y publicado en Render) y la bodega (la base de datos Supabase / Postgres). Detrás, en un estante, cinco proveedores cableados a la cocina: Google, Groq, AWS Rekognition, Tripo 3D y Correo. Un pedido viaja por el riel del cliente a la bodega.";

function drawing(pose) {
  const puckX = pose.x;
  const gateLift = pose.gate ? 26 : 0;
  const puckSvg = `<g data-part="puck" transform="${k.translateAlong(P, [puckX, 0, 0])}">${puck()}</g>`;
  const gateSvg = `<g data-part="gate">${gate()}<g data-part="bar" transform="${k.translateAlong(P, [0, 0, gateLift])}">${gateBar()}</g></g>`;
  const wires = cables();
  return [
    basePlate(P, BASE, { extraFeet: [[-31, -136], [-31, 26]] }),
    shelf(),
    ...MOD_X.map((_, i) => module(i)),
    cliente(),
    mostrador(),
    booth(),
    cocina(),
    wires,
    duct(),
    bodega(),
    track(),
    ...plates.map(([plan, text]) => namePlate(P, { ...plan, d: 12 }, text, { size: 6.4 })),
    puckX < GATE_X ? puckSvg + gateSvg : gateSvg + puckSvg,
  ].join("");
}

// ---------- SVG estático (pose: el pedido en la cocina, el cable de Groq activo) ----------
const LEGEND = [
  { n: "1", name: "Cliente", what: "navegador o celular" },
  { n: "2", name: "Mostrador: página web", what: "React, Vercel" },
  { n: "3", name: "Guardia", what: "revisa el token / la sesión" },
  { n: "4", name: "Cocina: servidor", what: "Express, Render" },
  { n: "5", name: "Bodega: base de datos", what: "Supabase / Postgres" },
  ...PROVIDERS.map((p, i) => ({ n: String.fromCharCode(65 + i), name: p.name, what: p.what })),
];
const CAPTION =
  "El cliente pide desde su navegador o celular; el mostrador (la página web) le muestra los helados y le lleva el pedido a la cocina (el servidor). En la puerta, el guardia revisa el token de la sesión cuando la ruta lo pide. La cocina es la única que habla con la bodega (la base de datos) y con los proveedores de afuera (A–E), cada uno por su propio cable.";

const staticDrawing = drawing({ x: STOP.cocina, gate: true })
  .replace(`<g data-wire="1"><g class="iso-wire" data-tone="lo"><path class="iso-line" data-tone="lo"`, `<g data-wire="1"><g class="iso-wire" data-tone="hi"><path class="iso-line" data-tone="hi"`);

write(
  "heladeria-maquina.svg",
  staticSvg({
    width: WIDTH,
    height: HEIGHT,
    drawing: staticDrawing,
    label: LABEL,
    fig: "Fig 1",
    title: "La heladería como máquina",
    hint: "Versión interactiva: heladeria-maquina.html",
    readout: "pedido en la cocina · pide a Groq",
    legend: LEGEND,
    caption: CAPTION,
  }),
);

// ---------- Página interactiva ----------
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL, body: drawing({ x: STOP.cliente, gate: false }) });
const spot = (point) => k.iso(point, P).map((v) => Math.round(v * 10) / 10);
const HOT = [
  { kind: "station", key: "cliente", at: spot([-229, -27, 12]) },
  { kind: "station", key: "mostrador", at: spot([-135, -30, 30]) },
  { kind: "station", key: "guardia", at: spot([-68, -16, 26]) },
  { kind: "station", key: "cocina", at: spot([20, -32, 30]) },
  { kind: "station", key: "bodega", at: spot([145, -33, 34]) },
  ...MOD_X.map((x, i) => ({ kind: "provider", key: i, at: spot([x, -133, 44]) })),
];

const live = `
const P = ${JSON.stringify(P)};
const STOP = ${JSON.stringify(STOP)};
const GATE_X = ${GATE_X};
const HOT = ${JSON.stringify(HOT)};
const NAMES = ${JSON.stringify(PROVIDERS.map((p) => [p.name, p.what]))};
const K = { slabOf, solidSvg, lineSvg, ring };
const drawerSvg = ${drawerSvg.toString()};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (s) => svg.querySelector(s);
const puck = $('[data-part="puck"]'), gate = $('[data-part="gate"]'), bar = $('[data-part="bar"]');
const drawer = $('[data-part="drawer"]'), lamp = $('[data-part="lamp"] .iso-solid'), screen = $('[data-part="screen"] .iso-line');
const wires = [...svg.querySelectorAll('[data-wire]')];
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const TEXT = {
  cliente: "1 · el cliente abre la tienda",
  mostrador: "2 · el mostrador arma el pedido",
  guardia: "3 · el guardia revisa la sesión",
  cocina: "4 · la cocina prepara la respuesta",
  bodega: "5 · la bodega guarda y entrega",
};
// Recorrido automático: [parada, segundos, cable activo o -1, barrera abierta]
const TOUR = [
  ["cliente", 2.6, -1, 0], ["mostrador", 2.8, -1, 0], ["guardia", 1.6, -1, 0], ["guardia", 1.2, -1, 1],
  ["cocina", 2.2, -1, 1], ["cocina", 1.5, 0, 1], ["cocina", 1.5, 1, 1], ["cocina", 1.5, 2, 1], ["cocina", 1.5, 3, 1], ["cocina", 1.5, 4, 1],
  ["bodega", 3.4, -1, 1], ["cliente", 3.2, -1, 1],
];
const TOUR_LEN = TOUR.reduce((s, t) => s + t[1], 0);
const tourAt = (t) => { t %= TOUR_LEN; for (const step of TOUR) { if (t < step[1]) return step; t -= step[1]; } return TOUR[0]; };
let x = STOP.cliente, target = x, station = "cliente", wire = -1, lift = 0, liftTo = 0, open = 0, openTo = 0;
let frame = 0, last = 0, clock = 0, touring = !still.matches, visible = false, idle = 0, before = true, lastWire = -2, lastOpen = -1, lastSay = "";
function choose(step) { station = step[0]; target = STOP[station]; wire = step[2]; }
function draw() {
  puck.setAttribute("transform", translateAlong(P, [x, 0, 0]));
  bar.setAttribute("transform", translateAlong(P, [0, 0, lift]));
  const nowBefore = x < GATE_X;
  if (nowBefore !== before) { before = nowBefore; if (before) gate.before(puck); else gate.after(puck); }
  if (Math.abs(open - lastOpen) > 0.05) { drawer.innerHTML = drawerSvg(K, P, open); lastOpen = open; }
  const at = (name) => Math.abs(x - STOP[name]) < 3;
  const showWire = at("cocina") ? wire : -2;
  if (showWire !== lastWire) {
    lastWire = showWire;
    wires.forEach((g, i) => {
      const on = showWire === -1 || showWire === i;
      const tone = on && showWire !== -2 ? "hi" : "lo";
      g.querySelector(".iso-wire").dataset.tone = tone;
      const path = g.querySelector(".iso-line");
      path.dataset.tone = tone;
      if (tone === "hi" && !still.matches) path.setAttribute("data-flow", ""); else path.removeAttribute("data-flow");
    });
  }
  if (lamp) lamp.toggleAttribute("data-lit", at("guardia"));
  screen.dataset.tone = at("cliente") ? "hi" : "lo";
  let text;
  if (at(station)) {
    text = TEXT[station];
    if (station === "guardia") text = lift > 20 ? "3 · sesión válida: puede pasar" : TEXT.guardia;
    if (station === "cocina" && wire >= 0) text = "4 · la cocina pide a " + NAMES[wire][0];
    if (station === "cocina" && wire === -1 && !touring) text = "4 · la cocina y sus 5 proveedores";
  } else text = "el pedido va hacia " + ({ cliente: "el cliente", mostrador: "el mostrador", guardia: "el guardia", cocina: "la cocina", bodega: "la bodega" })[station];
  if (text !== lastSay) { readout.textContent = text; lastSay = text; }
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) { clock += dt; choose(tourAt(clock)); }
  // la barrera cerrada detiene el pedido antes de la puerta
  let goal = target;
  if (lift < 22 && x < GATE_X && goal > GATE_X - 18) goal = Math.min(goal, GATE_X - 21);
  if (lift < 22 && x > GATE_X && goal < GATE_X + 18) goal = Math.max(goal, GATE_X + 21);
  const gap = goal - x, speed = Math.min(Math.abs(gap) / 0.45, 120);
  x = calm ? goal : x + Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
  if (Math.abs(goal - x) < 0.02) x = goal;
  liftTo = (touring ? tourAt(clock)[3] : 0) || target > GATE_X || x > GATE_X + 1 ? 26 : 0;
  lift = calm ? liftTo : lift + (liftTo - lift) * (1 - Math.exp(-dt / 0.22));
  if (Math.abs(liftTo - lift) < 0.02) lift = liftTo;
  openTo = Math.abs(x - STOP.bodega) < 3 ? 13 : 0;
  open = calm ? openTo : open + (openTo - open) * (1 - Math.exp(-dt / 0.3));
  if (Math.abs(openTo - open) < 0.02) open = openTo;
  draw();
  const settled = !touring && x === target && lift === liftTo && open === openTo;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const say = () => stage.setAttribute("aria-valuetext", TEXT[station]);
function steer(hot) {
  touring = false;
  if (hot.kind === "station") choose([hot.key, 0, -1, 0]); else choose(["cocina", 0, hot.key, 1]);
  say();
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600);
  run();
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const px = ((event.clientX - box.left) / box.width) * vb.width, py = ((event.clientY - box.top) / box.height) * vb.height;
  let best = HOT[0], dist = Infinity;
  for (const hot of HOT) { const d = Math.hypot(hot.at[0] - px, hot.at[1] - py); if (d < dist) { dist = d; best = hot; } }
  if (!(best.kind === station || (best.kind === "station" && best.key === station && wire === -1) || (best.kind === "provider" && station === "cocina" && wire === best.key))) steer(best);
});
const ORDER = ["cliente", "mostrador", "guardia", "cocina", "bodega"];
stage.addEventListener("keydown", (event) => {
  const here = ORDER.indexOf(station);
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") to = Math.min(ORDER.length - 1, here + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = Math.max(0, here - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = ORDER.length - 1;
  if (to === null) return;
  event.preventDefault();
  steer({ kind: "station", key: ORDER[to] });
});
draw();
`;

const plate = k.plateHtml({
  fig: "Fig 1",
  title: "La heladería como máquina",
  hint: "Pasa el cursor sobre una pieza",
  readout: "1 · el cliente abre la tienda",
  keys: [
    { mark: "lit", label: "El pedido que viaja por el riel" },
    { mark: "raised", label: "Las piezas de la heladería" },
    { mark: "dashed", label: "Cable activo hacia un proveedor" },
  ],
  caption:
    "1 Cliente (navegador o celular) · 2 Mostrador: página web (React, Vercel) · 3 Guardia: revisa el token / la sesión · 4 Cocina: servidor (Express, Render) · 5 Bodega: base de datos (Supabase / Postgres). En el estante, de izquierda a derecha: Google (login), Groq (chatbot Gelbot), AWS Rekognition (login facial de admins), Tripo 3D (modelos 3D de productos) y Correo (nodemailer). " +
    CAPTION,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="La heladería como máquina: las flechas mueven el pedido de una pieza a otra" aria-valuetext="${TEXT0()}">${svg}</div>`,
});
function TEXT0() { return "1 · el cliente abre la tienda"; }

write("heladeria-maquina.html", livePage({ title: "La heladería como máquina", plate, script: live }));
