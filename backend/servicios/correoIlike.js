// ─── Correo para ilike ──────────────────────────────────────
// En ilike, "_" y "%" son comodines (y "\" es el carácter de escape). Se escapan para comparar el
// correo exacto sin distinguir mayúsculas: así "a_b@x.com" no encaja con la cuenta "axb@x.com".
const correoParaIlike = (correo) => String(correo).replace(/[\\%_]/g, (c) => `\\${c}`);

module.exports = { correoParaIlike };
