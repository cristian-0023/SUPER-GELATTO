// Piezas compartidas por las dos figuras: base con patas, placas con nombre,
// la tarjeta del SVG estático (sin JavaScript) y la página HTML interactiva.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";

export { k };
export const SRC = dirname(fileURLToPath(import.meta.url));
export const OUT = join(SRC, "..");

// El kit entero, sin "export", para pegarlo dentro de la página interactiva.
export const kitScript = () => readFileSync(join(SRC, "kit", "iso-kit.mjs"), "utf8").replace(/^export /gm, "");

export const helpers = (P) => {
  const at = (point) => k.iso(point, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  return { at, S, L, D, byDepth };
};

// Placa base sobre patas, con ranura, tornillos en las esquinas y halo.
export function basePlate(P, plan, { height = 10, foot = 5, feet = 22, extraFeet = [] } = {}) {
  const { S, L, D, at, byDepth } = helpers(P);
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, -height - foot, height, P)}"/>`];
  for (const [x, y] of byDepth([...k.corners(plan, feet), ...extraFeet])) {
    out.push(S(k.cylinder(x, y, 7, -height - foot, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -height - foot + 1.6, foot - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(plan, -height, height, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(plan, -height + 3, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(plan, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(plan, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

// Placa con nombre grabado (la única palabra dentro del dibujo de cada pieza).
export function namePlate(P, { x, y, w, d = 9 }, text, { z = 0, size = 4.2, lit = false } = {}) {
  const { S, L, D, at } = helpers(P);
  const plan = { x, y, w, d, r: 1.2 };
  const top = z + 0.9;
  return [
    S(k.slabOf(plan, z, 0.9, P, 4), { tone: lit ? "hi" : "lo", crease: "none" }),
    L(k.planOutline(k.insetPlan(plan, 1.2), top, P, 4), { tone: "faint" }),
    D([at([x + 2.6, y + d / 2, top]), at([x + w - 2.6, y + d / 2, top])], { size: 0.42 }),
    k.faceTextSvg(k.topMatrix([x + w / 2, y + d / 2 + size * 0.36], top, P, "x"), text, { size, tone: lit ? "hi" : "mid", anchor: "middle" }),
  ].join("");
}

// Envuelto convexo (para la sombra de partes hechas a mano).
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Parte un texto en renglones de como mucho `max` letras.
export function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max) { lines.push(line); line = word; } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

// Los colores oscuros del kit, para el SVG estático cuando el visor está en modo oscuro.
const DARK_TOKENS = k.ISO_CSS.match(/\.iso\{([^}]*)\}/)[1];

// SVG estático para GitHub: tarjeta con fondo propio (se lee igual en fondo blanco o negro),
// esquinas con Fig, título, pista y lectura, el dibujo, y debajo la leyenda numerada y el pie.
export function staticSvg({ width, height, drawing, label, fig, title, hint, readout, legend, caption }) {
  const W = 760;
  const pad = 22;
  const drawW = W - pad * 2;
  const drawH = Math.round((drawW * height) / width);
  const cardH = drawH + 64;
  const colW = (W - pad * 2) / 2;
  const legendRows = Math.ceil(legend.length / 2);
  const capLines = wrap(caption, 126);
  const legendTop = cardH + 26;
  const capTop = legendTop + legendRows * 19 + 12;
  const H = capTop + capLines.length * 17 + 14;
  const corner = (x, y, anchor, text, cls) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
  const items = legend
    .map((item, i) => {
      const x = pad + (i % 2) * colW;
      const y = legendTop + Math.floor(i / 2) * 19;
      return `<g><circle cx="${x + 7}" cy="${y - 4}" r="7.5" class="sg-num"/><text x="${x + 7}" y="${y - 0.6}" text-anchor="middle" class="sg-numtext">${esc(item.n)}</text><text x="${x + 21}" y="${y}" class="sg-legend"><tspan class="sg-strong">${esc(item.name)}</tspan>${item.what ? ` · ${esc(item.what)}` : ""}</text></g>`;
    })
    .join("");
  const cap = capLines.map((line, i) => `<text x="${pad}" y="${capTop + i * 17}" class="sg-caption">${esc(line)}</text>`).join("");
  const css = `${k.ISO_CSS}
@media (prefers-color-scheme: dark){.iso[data-theme="light"]{${DARK_TOKENS}}}
.sg-page{fill:var(--anatomy-page)}
.sg-card{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.sg-corner{fill:var(--anatomy-muted);font-family:var(--anatomy-mono);font-size:11px;letter-spacing:.06em}
.sg-corner-fig,.sg-corner-read{fill:var(--anatomy-text)}
.sg-legend{fill:var(--anatomy-text);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.sg-strong{fill:var(--anatomy-strong);font-weight:600}
.sg-caption{fill:var(--anatomy-muted);font:12.5px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.sg-num{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.sg-numtext{fill:var(--anatomy-strong);font-family:var(--anatomy-mono);font-size:10px;font-weight:600}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="iso" data-theme="light" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}"><title>${esc(title)}</title><style>${css}</style>
<rect class="sg-page" x="0" y="0" width="${W}" height="${H}" rx="10"/>
<rect class="sg-card" x="${pad / 2}" y="${pad / 2}" width="${W - pad}" height="${cardH - pad / 2}"/>
${corner(pad, pad + 16, "start", fig, "sg-corner sg-corner-fig")}${corner(W - pad, pad + 16, "end", title.toUpperCase(), "sg-corner")}
${corner(pad, cardH - 12, "start", hint.toUpperCase(), "sg-corner")}${corner(W - pad, cardH - 12, "end", readout, "sg-corner sg-corner-read")}
<svg x="${pad}" y="34" width="${drawW}" height="${drawH}" viewBox="0 0 ${width} ${height}" class="iso-svg" style="--anatomy-paper:var(--anatomy-card)">${drawing}</svg>
${items}${cap}</svg>`;
}

// Página interactiva: sigue el tema del sistema (claro u oscuro) y el idioma es español.
export function livePage({ title, plate, script }) {
  const pick = `document.body.dataset.theme=new URLSearchParams(location.search).get("tema")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");`;
  return k
    .pageHtml({ title, theme: "light", body: plate, script: kitScript() + script, width: 760 })
    .replace('<html lang="en">', '<html lang="es">')
    .replace('<main class="iso-page">', `<script>${pick}</script><main class="iso-page">`)
    .replace("</style>", ".iso-stage{outline:none;touch-action:pan-y}.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}</style>");
}

export function write(name, text) {
  writeFileSync(join(OUT, name), text);
  console.log(`escrito ${name} · ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
}
