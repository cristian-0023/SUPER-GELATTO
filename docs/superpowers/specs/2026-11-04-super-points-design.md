# Super Points — Diseño

## Intención
Hoy los Super Points son decoración: el perfil muestra 120 puntos falsos a todos, el carrito promete puntos que nunca se entregan y la tabla `super_points` está vacía. Queremos un programa real: cada compra pagada da puntos, el contador muestra el saldo verdadero y los puntos se cambian por descuentos, para que el cliente vuelva a comprar.

## Objetivos
- Cada compra "Pagado" suma puntos automáticamente.
- El perfil muestra saldo real, valor en plata, nivel real e historial.
- El cliente canjea puntos al pagar, dentro del tope de su nivel.
- Mantener los 4 niveles de la página principal.

## No objetivos
- Automatizar los otros beneficios (envío gratis, cumpleaños, muestras, eventos): siguen como están anunciados y el equipo los da a mano.
- Vencimiento de puntos: no vencen.
- Dar puntos por compras anteriores: todos arrancan en cero.
- Ajustes manuales de puntos desde el panel de admin.

## Lo que sería un fracaso aunque funcione
- Que alguien gaste dos veces los mismos puntos, o fije desde el navegador cuántos tiene o cuánto valen.
- Que el descuento supere el tope del nivel.
- Que una compra quede guardada sin sus puntos, o los puntos sin la compra.

## Reglas del negocio
**Ganar:** 1 punto por cada $100 realmente pagados, redondeando hacia abajo. Se calcula sobre el total después del descuento. $9.000 = 90 puntos. Pedido de $20.000 con $4.000 de descuento = 160 puntos.

**Valor:** 1 punto = $5 de descuento. El cliente recibe de vuelta cerca del 5 %.

**Niveles** (por puntos GANADOS en toda la historia; gastar puntos no baja el nivel):

| Nivel | Puntos ganados | Máximo de la compra pagable con puntos |
|---|---|---|
| Lover | 0 – 100 | 5 % |
| Fan | 101 – 500 | 10 % |
| Pro | 501 – 1000 | 15 % |
| Master | 1001 o más | 20 % |

**Canjear:** el cliente elige cuántos puntos usar al pagar, en números enteros. Máximo usable = el menor entre su saldo y `piso(total × % del nivel ÷ $5)`. El nivel es el que tiene ANTES de esta compra, y `total` es el subtotal con precios de la base. Los puntos de una compra quedan disponibles para la siguiente.

**Pago fallido:** no gana ni gasta puntos.

**Admin marca una venta como cobrada:** si una venta "Fallido" o "Pendiente" pasa desde el panel a un estado de `ESTADOS_COBRADOS`, el cliente gana sus puntos por el total de esa venta (decisión del usuario). Se suman una sola vez por venta, aunque el estado cambie varias veces, y nunca en una venta ya revertida por cancelación. Si la venta no tiene usuario, no pasa nada. Esta ruta no descuenta stock (ya era así); queda fuera de este proyecto.

**Cancelar:** cuando una venta cobrada pasa a "Cancelado":
- se devuelven los puntos canjeados en esa venta;
- se quitan los ganados, sin dejar el saldo por debajo de cero (si ya los gastó, se quita lo que haya);
- los puntos ganados en esa venta dejan de contar para el nivel, así que el nivel puede bajar;
- pasa una sola vez por venta, aunque el estado se cambie varias veces.

Si un admin saca una venta de "Cancelado", los puntos NO se vuelven a mover: la cancelación es definitiva para los puntos (decisión del diseñador, para evitar regalos por error).

La reversa solo actúa sobre lo que está en la libreta: una venta sin movimientos (Fallido, Pendiente o anterior a este cambio) no mueve nada al cancelarse (decisión del diseñador).

Si el cliente ya gastó los puntos de una venta cancelada, la diferencia se perdona: se anota lo que realmente se pudo quitar, y el nivel descuenta TODOS los puntos ganados en esa venta (decisión del diseñador). Por eso la libreta debe poder saber, por venta, cuánto se ganó aunque se haya quitado menos.

Las ventas "Pagado" anteriores a este cambio no tienen puntos.

## Approaches
- **A. Libreta de movimientos (elegida por el usuario):** cada cambio es una fila; el saldo es la suma. Da historial y auditoría, y usa la tabla existente.
- **B. Un número en `usuario`:** más rápida, sin historial; si se desajusta no se puede explicar por qué.
- **C. Calcular desde `venta`:** no guarda nada nuevo, pero se complica con canjes y cancelaciones y escala mal.

## Cómo se construye
**Base de datos** (migración aditiva + rollback; la aplica el usuario en el SQL Editor):
- Extender `public.super_points` como libreta: tipo de movimiento (`ganado`, `canjeado`, `devuelto`, `revertido`), puntos con signo, `id_usuario`, `id_venta`, fecha. La tabla está vacía, así que no hay datos que migrar. Índice por usuario, restricción para que un mismo tipo no se repita en la misma venta, y RLS sin acceso para anon/authenticated, como el resto.
- `venta`: nueva columna con los puntos usados y el descuento en pesos. `venta.total` pasa a ser lo realmente pagado; los ingresos del panel suman ese valor.
- `registrar_venta`: nuevo parámetro opcional `p_puntos_usar integer default 0`. Dentro de la misma transacción: bloquea la fila del usuario para serializar pagos simultáneos, calcula el nivel y el máximo, rechaza si se pasa, descuenta y anota los movimientos. Nuevos errores `PUNTOS_INSUFICIENTES` y `PUNTOS_EXCEDEN_TOPE`. Solo la ejecuta service_role. Con el default, el código viejo sigue funcionando: se publica primero la migración, después el código.
- Nueva función (solo service_role) para revertir una venta cancelada, en una transacción.
- Regla de negocio en una sola parte: valores 100, 5 y la tabla de niveles viven en la base; el servidor y la página los reciben por la API, sin repetirlos en el código.

**Servidor** (`backend/server.js`):
- `POST /api/payments/process`: acepta `puntosUsar` (entero ≥ 0), valida el tipo y lo pasa a la función. El usuario sale del token, como ya hace.
- `GET /api/me/points` con `requireAuth`: saldo, valor en plata, nivel, puntos para el siguiente nivel, % máximo e historial paginado (tope 50).
- `PUT /api/admin/sales/:id/status`: al pasar a "Cancelado" llama a la función de reversa; al pasar a un estado cobrado llama a la función que otorga puntos pendientes; en ambos casos, en la misma transacción que el cambio de estado o con un fallo visible: si falla, responde error y no da éxito falso.
- El dashboard de admin y el correo de recibo muestran el descuento cuando lo hay.

**Página** (`frontend/`, con la skill Impeccable):
- `CheckoutPage` / `PaymentGateway`: selector de puntos con el máximo, el descuento y el total actualizado. El servidor decide el total final.
- `ProfilePage`: saldo, valor, nivel y progreso reales, con historial; sin el "120" ni el "Lover" fijos.
- `CartDrawer`: corregir "+X SuperPoints" a la regla real.
- `Navbar`: el contador muestra el saldo real con sesión iniciada.
- `Home`: cambiar los textos de descuento por "Paga hasta X % con tus puntos"; mantener los demás beneficios.

## Restricciones
- TDD obligatorio: PGlite para la base; supertest + Supabase falso para el servidor.
- El backend real corre en Vercel (serverless): nada de estado en memoria para los puntos.
- Revisar el `error` de cada llamada a Supabase; mensajes en español sin detalles internos.
- Toca pagos: auditoría de seguridad antes de unir.
- Sin Co-Authored-By. Repo público: sin datos personales.

## Queda a criterio del constructor
- Nombres exactos de columnas y funciones.
- Diseño visual del selector (con Impeccable).
- Cómo se paginan los movimientos.
