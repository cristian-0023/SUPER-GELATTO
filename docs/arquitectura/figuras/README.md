# Figuras de la arquitectura

Dos dibujos que explican SUPER-GELATTO como si fuera una máquina de verdad. Cada uno viene en dos versiones:

- **`.svg`**: imagen quieta, sin código, para verla dentro de la documentación en GitHub. Tiene su propio fondo, así que se lee igual en el tema claro y en el oscuro.
- **`.html`**: la misma figura con movimiento. Ábrela en el navegador (doble clic al archivo descargado).

| Figura | Qué muestra |
|---|---|
| `heladeria-maquina.svg` / `.html` | **La heladería como máquina.** En fila: 1 Cliente (navegador o celular) → 2 Mostrador: página web (React, Vercel) → 3 Guardia (revisa el token / la sesión) → 4 Cocina: servidor (Express, Render) → 5 Bodega: base de datos (Supabase / Postgres). Detrás, en un estante, los proveedores cableados a la cocina: Google (login), Groq (chatbot Gelbot), AWS Rekognition (login facial de admins), Tripo 3D (modelos 3D de productos) y Correo (nodemailer). En la versión con movimiento, el pedido recorre el riel; pasa el cursor sobre una pieza o usa las flechas del teclado. |
| `viaje-compra.svg` / `.html` | **El viaje de una compra.** Una cinta lleva el pedido: 1 Carrito (CartContext) → 2 Pago (`POST /api/payments/process`: revisa el carrito, ignora los precios del navegador, por defecto máximo 10 intentos por minuto) → 3 Caja registradora `registrar_venta` (guarda venta + detalle_venta y descuenta stock, todo o nada; si falta stock, `STOCK_INSUFICIENTE` y no se guarda nada) → 4 Estados (Pagado → En proceso → Enviado → Entregado…) con 5 un correo al cliente en cada cambio. En la versión con movimiento, un clic (o la barra espaciadora) cambia entre una compra con stock y otra sin stock. |

## Cómo regenerarlas

Se necesita Node.js 18 o más nuevo; no hay que instalar nada más. Desde la raíz del repositorio:

```sh
node docs/arquitectura/figuras/src/heladeria-maquina.mjs
node docs/arquitectura/figuras/src/viaje-compra.mjs
```

Cada comando reescribe su `.svg` y su `.html` en esta carpeta.

## Qué hay en `src/`

- `heladeria-maquina.mjs` y `viaje-compra.mjs`: arman cada figura pieza por pieza.
- `common.mjs`: piezas compartidas (base, placas con nombre, la tarjeta del SVG y la página HTML).
- `kit/iso-kit.mjs`: el kit de dibujo isométrico de la skill Anatomy (licencia MIT, en `kit/LICENSE`).
