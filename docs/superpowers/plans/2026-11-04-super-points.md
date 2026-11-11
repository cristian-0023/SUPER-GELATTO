# Super Points — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada compra cobrada otorgue Super Points reales, canjeables por descuento según el nivel, con saldo, nivel e historial visibles.

**Architecture:** La regla vive en la base: la libreta `super_points` y funciones transaccionales (`registrar_venta`, `cambiar_estado_venta`). El servidor valida la entrada y expone la información; la página solo muestra y pide, nunca decide.

**Tech Stack:** Postgres/Supabase, Express, React, vitest + PGlite + supertest.

**Spec:** `docs/superpowers/specs/2026-11-04-super-points-design.md`

## Global Constraints
- $100 pagados = 1 punto, piso. 1 punto = $5.
- Niveles por puntos ganados: Lover 0–100 (5 %), Fan 101–500 (10 %), Pro 501–1000 (15 %), Master 1001+ (20 %).
- Tipos de movimiento: `ganado`, `canjeado`, `devuelto`, `revertido`. Saldo nunca negativo.
- Funciones SQL: `security invoker`, `set search_path = ''`, EXECUTE solo para service_role.
- Migración aditiva e idempotente, con rollback; nadie la aplica en la base real salvo el usuario.
- Nada de estado en memoria: el backend corre en Vercel serverless.
- Sin Co-Authored-By. Commits en español. Cambios de pantalla con la skill `impeccable`.
- Backend: `cd backend && npm test` empieza con 386 pruebas en verde y debe terminar con más.

## Review Focus
- Dos pagos simultáneos con el mismo saldo: solo el primero canjea; el segundo recibe PUNTOS_INSUFICIENTES (Task 1).
- Cliente llega al pago con un valor de puntos desactualizado o manipulado (negativo, decimal, texto, enorme): 400 sin venta (Task 2).
- Estado que va y viene (Pagado → Cancelado → Pagado → Cancelado): los puntos se mueven una sola vez (Task 1).
- Venta con precios decimales o total menor a $100: piso correcto, 0 puntos, sin error (Task 1).
- La sesión vence con puntos elegidos: al volver no se pierde el carrito ni queda un descuento falso en pantalla (Task 3).

---

### Task 1: Base de datos

**Files:**
- Create: `supabase/migrations/20261104130000_super_points.sql`
- Create: `supabase/rollbacks/20261104130000_super_points.rollback.sql`
- Test: `backend/tests/db/super_points.test.js`

**Interfaces:**
- Produces:
  - Tabla `public.super_points`: `id_points` pasa a identity; `puntos_generados` es el valor con signo; nuevas `tipo text` (check de los 4 tipos), `id_usuario bigint` (FK a usuario, on delete cascade). Único `(id_venta, tipo)`. Índice `(id_usuario, fecha_generacion desc)`. La tabla tiene 0 filas.
  - `public.venta`: `puntos_usados integer not null default 0`, `descuento_puntos numeric not null default 0`. `total` = lo realmente pagado.
  - `public.super_points_reglas() returns jsonb`: `{pesos_por_punto, valor_punto, niveles:[{nombre,min,max,pct}]}`. Único lugar con estos valores.
  - `public.super_points_resumen(p_id_usuario bigint) returns jsonb`: `{saldo, ganados, nivel, pct_max, valor_saldo, puntos_para_siguiente, siguiente_nivel}`.
  - `public.registrar_venta(p_id_usuario bigint, p_items jsonb, p_estado text, p_puntos_usar integer default 0) returns jsonb`: reemplaza a la de 3 parámetros (borrarla primero para no dejar dos versiones) y agrega `puntos_usados, descuento, puntos_ganados, saldo` a su respuesta actual. Errores nuevos P0001: `PUNTOS_INVALIDOS`, `PUNTOS_INSUFICIENTES`, `PUNTOS_EXCEDEN_TOPE`.
  - `public.cambiar_estado_venta(p_id_venta bigint, p_estado text) returns jsonb`: en una transacción, actualiza el estado y aplica los puntos. Error `VENTA_NO_EXISTE`.

**Lógica que el código no deja adivinar:**
- `ganados` = suma de filas `ganado` cuyas ventas no tienen fila `revertido`.
- Al cancelar se escribe SIEMPRE una fila `revertido` si la venta tenía `ganado`, aunque se quite 0: esa fila marca la venta como revertida. Valor = `-min(puntos ganados, saldo tras devolver lo canjeado)`.
- En `Fallido`, `p_puntos_usar` se ignora y no se escribe nada en la libreta.
- `registrar_venta` bloquea la fila de `usuario` (`for update`) antes de leer el saldo.
- `cambiar_estado_venta`: a un estado cobrado (los mismos de `ESTADOS_COBRADOS`, salvo `Pagado` ya otorgado) otorga si no hay `ganado` ni `revertido` para esa venta y tiene usuario; a `Cancelado`, revierte si no hay `revertido`. Salir de `Cancelado` no mueve nada.

- [ ] **Step 1: Escribir las pruebas** con PGlite: `gana piso(total/100)`; `canje descuenta y gana sobre lo pagado` (Fan, $20.000, 400 puntos → total 18000, gana 180); `excede tope → PUNTOS_EXCEDEN_TOPE sin venta`; `excede saldo → PUNTOS_INSUFICIENTES sin venta`; `valor negativo → PUNTOS_INVALIDOS`; `Fallido no mueve puntos`; `nivel en cada frontera 100/101/500/501/1000/1001`; `total < 100 → 0 puntos`; `dos canjes seguidos no pasan del saldo`; `llamada de 3 argumentos sigue funcionando`; `Fallido → Pagado otorga una vez`; `Pagado → Cancelado devuelve y quita`; `puntos ya gastados: saldo queda en 0 y el nivel baja`; `ida y vuelta de estados mueve una sola vez`; `venta sin movimientos no mueve nada`; `anon y authenticated no leen super_points ni ejecutan las funciones`; `migración dos veces y rollback`.
- [ ] **Step 2: Correr y ver el rojo.** Run: `cd backend && npx vitest run tests/db/super_points.test.js` — Expected: FAIL por funciones y columnas inexistentes.
- [ ] **Step 3: Escribir la migración y su rollback.**
- [ ] **Step 4: Verde.** Run: `cd backend && npm test` — Expected: todo en verde.
- [ ] **Step 5: Commit** `feat: libreta de Super Points y canje en registrar_venta`.

### Task 2: Servidor

**Files:**
- Modify: `backend/server.js` (`/api/payments/process`, `ERRORES_VENTA`, `PUT /api/admin/sales/:id/status`, recibo, dashboard, `mockRegistrarVenta`)
- Test: `backend/tests/api/superPoints.test.js`, `backend/tests/helpers/fakeSupabase.js`

**Interfaces:**
- Consumes: las funciones de Task 1.
- Produces:
  - `POST /api/payments/process` acepta `puntosUsar` y responde además `puntos: {usados, descuento, ganados, saldo}`.
  - `GET /api/me/points?limit&offset` (`requireAuth`, tope 50) → `{ok, saldo, ganados, nivel, pctMax, valorSaldo, puntosParaSiguiente, siguienteNivel, movimientos:[{tipo, puntos, fecha, idVenta}]}`.
  - `GET /api/points/rules` (público, `Cache-Control: public, max-age=3600`) → `{ok, pesosPorPunto, valorPunto, niveles}`.

- [ ] **Step 1: Pruebas:** `puntosUsar` inválido (negativo, decimal, texto, null, mayor a 1000000) → 400 sin rpc; ausente → 0; se manda a `registrar_venta` junto al usuario del token; `PUNTOS_INSUFICIENTES`/`PUNTOS_EXCEDEN_TOPE` → 400 con mensaje en español; `/api/me/points` sin token 401, otro usuario imposible, paginado, 500 sin detalles si falla; `/api/points/rules` público; cambio de estado usa `cambiar_estado_venta` y falla con 500 sin éxito falso, conservando el correo; recibo y dashboard muestran el descuento.
- [ ] **Step 2: Correr y ver el rojo.** Run: `cd backend && npx vitest run tests/api/superPoints.test.js` — Expected: FAIL.
- [ ] **Step 3: Implementar**, actualizando `fakeSupabase` y `mockRegistrarVenta` para que el modo simulado siga funcionando. Las pruebas de estado existentes se adaptan a la nueva rpc sin quitar aserciones.
- [ ] **Step 4: Verde.** Run: `cd backend && npm test` — Expected: todo en verde.
- [ ] **Step 5: Commit** `feat: pagos y panel con Super Points`.

### Task 3: Página

**Files:**
- Create: `frontend/src/utils/superPoints.js`
- Modify: `frontend/src/pages/CheckoutPage.jsx`, `frontend/src/components/PaymentGateway.jsx`, `frontend/src/pages/ProfilePage.jsx`, `frontend/src/components/CartDrawer.jsx`, `frontend/src/components/Navbar.jsx`, `frontend/src/pages/Home.jsx`
- Test: `backend/tests/frontend/superPoints.test.js`

**Interfaces:**
- Consumes: los endpoints de Task 2 y `apiFetch`/`getToken` de `utils/api.js`.
- Produces: en `superPoints.js`: `calcularCanje({subtotal, saldo, pctMax, valorPunto, puntosElegidos}) → {maximo, puntos, descuento, total}`, `puntosAGanar(total, pesosPorPunto) → number`, `progresoNivel(ganados, niveles) → {actual, siguiente, porcentaje}`.

- [ ] **Step 1: Pruebas** de esas 3 funciones, con el ejemplo Fan $20.000/400 puntos, redondeo y fronteras.
- [ ] **Step 2: Correr y ver el rojo.** Run: `cd backend && npx vitest run tests/frontend/superPoints.test.js` — Expected: FAIL.
- [ ] **Step 3: Implementar las funciones** y aplicar la skill `impeccable` a los cambios de pantalla: selector en el pago; perfil con saldo, valor, nivel, progreso e historial (sin el 120 ni el "Lover" fijos); carrito con `puntosAGanar`; saldo real en el menú; Home con "Paga hasta X % con tus puntos", desde `/api/points/rules`, manteniendo los demás beneficios. Si el pago da 401, se limpia la selección de puntos y se conserva el carrito. Si las reglas o el saldo no cargan, la página sigue funcionando sin selector.
- [ ] **Step 4: Verificar.** Run: `cd backend && npm test` y `cd frontend && npx vite build` — Expected: verde y compila. Probar el flujo en navegador con el modo simulado.
- [ ] **Step 5: Commit** `feat: Super Points en la página`.

### Task 4: Revisión y documentación

- [ ] **Step 1:** Actualizar `docs/arquitectura/` (01, 04, 07 y 08) con las rutas, reglas y tablas nuevas, sin detalles de vulnerabilidades.
- [ ] **Step 2:** Auditoría con `security-scanner` y `code-reviewer`; corregir con prueba previa y volver a auditar lo crítico.
- [ ] **Step 3:** Informar al usuario. Orden de publicación: migración → unir → compra de prueba.
